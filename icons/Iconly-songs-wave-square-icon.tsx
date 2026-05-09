
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlySongswavesquare = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M16.521 13.543C16.521 13.957 16.185 14.293 15.771 14.293C15.357 14.293 15.021 13.957 15.021 13.543V10.457C15.021 10.043 15.357 9.707 15.771 9.707C16.185 9.707 16.521 10.043 16.521 10.457V13.543ZM12.75 16.402C12.75 16.816 12.414 17.152 12 17.152C11.586 17.152 11.25 16.816 11.25 16.402V7.598C11.25 7.184 11.586 6.848 12 6.848C12.414 6.848 12.75 7.184 12.75 7.598V16.402ZM8.979 13.543C8.979 13.957 8.643 14.293 8.229 14.293C7.815 14.293 7.479 13.957 7.479 13.543V10.457C7.479 10.043 7.815 9.707 8.229 9.707C8.643 9.707 8.979 10.043 8.979 10.457V13.543ZM15.974 2.5H8.026C4.721 2.5 2.5 4.623 2.5 7.783V16.218C2.5 19.377 4.721 21.5 8.026 21.5H15.974C19.279 21.5 21.5 19.377 21.5 16.218V7.783C21.5 4.623 19.279 2.5 15.974 2.5Z" fill={secondColor}></path>
		</svg>
    ) 
}