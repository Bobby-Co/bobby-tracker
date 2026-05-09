
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlyNavigation = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M19.0067 8.76442L6.37071 3.63142C6.36871 3.63042 6.36571 3.62942 6.36371 3.62742C5.72371 3.38142 5.03171 3.49542 4.50871 3.93642C3.98671 4.37442 3.75371 5.03642 3.88771 5.71342L6.73471 19.0514C6.89971 19.8264 7.51271 20.3894 8.29871 20.4874C8.37871 20.4964 8.45671 20.5014 8.53571 20.5014C9.22971 20.5014 9.85571 20.1174 10.1707 19.4774L12.8927 13.9354L18.8257 12.2224C19.5867 12.0014 20.1057 11.3484 20.1467 10.5574C20.1887 9.76642 19.7407 9.06242 19.0067 8.76442Z" fill={secondColor}></path>
		</svg>
    ) 
}